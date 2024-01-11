import {asyncHandler} from "../utils/async-Handler.js";
import {ApiError} from "../utils/ApiError.js";
import { User } from "../models/users.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import  jwt from "jsonwebtoken";
import mongoose from "mongoose";


const generateAccessAndRefreshTokens = async(userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({validateBeforeSave:false});


        return {accessToken,refreshToken};
    } catch(error) {
        throw new ApiError(500,"Something went wrong... While generating access and refresh token!");
    }
}

const registerUser = asyncHandler(async (req,res) => {
    
    const {fullname,username,password,email} = req.body
    
    if(
        [fullname,email,username,password].some((field) => field?.trim() === "")
    ) {
        throw new ApiError(400,"All fields are requierd!");
    }

    const existingUser = await User.findOne({
        $or: [{username},{email}]
    });

    if(existingUser) throw new ApiError(409,"User already exists");


    const localPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path; this will give error if we dont give cover image
    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) coverImageLocalPath = req.files.coverImage[0].path 

    if(!localPath) throw new ApiError(400,"Avatar file is required!");

    const avatar = await uploadOnCloudinary(localPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if(!avatar) throw new ApiError(500,"Please upload avatar again");

    const user = await User.create({
        fullname,
        avatar:avatar.url,
        username:username.toLowerCase(),
        coverImage:coverImage?.url || "",
        email,
        password
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    );

    if(!createdUser) throw new ApiError(500,"Something went wrong while registering the user!");
    
    return res.status(201).json(new ApiResponse(200,createdUser,"user registered successfully"));
});

const loginUser = asyncHandler(async (req,res) => {

    const {email,username,password} = req.body;

    if(!username && !email) throw new ApiError(400,"Username or email is required!");

    const user = await User.findOne({
        $or:[{username},{email}]
    })

    if(!user) throw new ApiError(404,"User doesnot exist!");


    const isPasswordValid = await user.isPasswordCorrect(password);

    if(!isPasswordValid) throw new ApiError(401,"Invalid user credentials");


    // creating access and refresh tokens
    const {accessToken,refreshToken} = await generateAccessAndRefreshTokens(user._id);

    // optional step we can pass the saved object from above to reduce load on db
    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");


    const options = {
        httpOnly:true,
        secure:process.env.ENVIRONMENT == "development" ? false : true
    }

    return res.status(200)
    .cookie("accessToken",accessToken,options)
    .cookie("refreshToken",refreshToken,options)
    .json(
        new ApiResponse(200,{user:loggedInUser,accessToken,refreshToken},"User Logged in successfully!")
    )
});

const logOutUser = asyncHandler(async(req,res) => {


    await User.findByIdAndUpdate(req.user._id,{
        $set:{
            refreshToken:undefined
        }
    },{
        new:true
    })

    const options = {
        httpOnly:true,
        secure:process.env.ENVIRONMENT == "development" ? false : true
    }


    return res.status(202)
    .clearCookie("accessToken",options)
    .clearCookie("refreshToken",options)
    .json(new ApiResponse(200,{},"Logout successful!"))
});

const refreshAccessToken = asyncHandler(async(req,res) => {

    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshAccessToken;

    if(!incomingRefreshToken) throw new ApiError(401,"unauthorized request!");

    try {
        const decodedToken = jwt.verify(incomingRefreshToken,process.env.REFERSH_TOKEN_SECRET);
        const user = await User.findById(decodedToken?._id);
    
        if(!user) throw new ApiError(401,"Invalid refresh token");
    
        if(incomingRefreshToken !== user.refreshToken) throw new ApiError(401,"Refresh token expired");
    
        const options = {
            httpOnly:true,
            secure:process.env.ENVIRONMENT == "development" ? false : true
        }
    
        const {accessToken,refreshToken} = await generateAccessAndRefreshTokens(user._id);
    
        return res.status(200)
        .cookie("accessToken",accessToken,options)
        .cookie("refreshToken",refreshToken,options)
        .json(new ApiResponse(201,{accessToken,refreshToken},"Access token refreshed!"));
    } catch (error) {
        throw new ApiError(401,error?.message || "Invalid refresh token");
    }
    
});

const changeCurrentPassword = asyncHandler(async(req,res) => {
    const {oldPassword,newPassword} = req.body;
    const user = await User.findById(req.user?._id);

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
    if(!isPasswordCorrect) throw new ApiError(401,"Invalid password");

    user.password = newPassword;
    await user.save({validateBeforeSave:false});

    return res.status(200).
    json(new ApiResponse(200,{},"Passowrd changed successfully"));
});

const getCurrentUser = asyncHandler(async(req,res) => {
    return res.status(200)
    .json(new ApiResponse(200,req.user,"User fetched successfully"));
});
// try to keep text update endpoint different from image update endpoint
const updateAccountDetails = asyncHandler(async(req,res) => {
    const {fullname,email} = req.body;

    if(!fullname || !email) throw new ApiError(400,"All fields are required");
    const user = User.findByIdAndUpdate(req.user?._id,
        {
            $set:{
                fullname,email
            }
        },{new :true}
    ).select("-password");

    return res.status(200).
    json(new ApiResponse(200,user,"Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async(req,res) => {
    const avatarLocalPath = req.file?.path;

    if(!avatarLocalPath) throw new ApiError(400,"Avatar file is missing!");

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if(!avatar.url) throw new ApiError(500,"Error while uploading avatar");

    const user = await User.findByIdAndUpdate(req.user?._id,{
        $set:{avatar:avatar.url}
    },{new:true}).select("-password");

    return res.status(200).json(new ApiResponse(200,user,"Avatar updated successfully!"));
});

const updateUserCover = asyncHandler(async(req,res) => {
    const coverImageLocalPath = req.file?.path;

    if(!coverImageLocalPath) throw new ApiError(400,"Cover file is missing!");

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if(!coverImage) throw new ApiError(500,"Error while uploading file");

    const user = await User.findByIdAndUpdate(req.user?._id,{
        Sset:{
            coverImage:coverImage.url
        }
    },{new:true}).select("-password");

    return res.status(200)
    .json(new ApiResponse(200,user,"Cover Image updated successfully!"));
})


const getUserChannelProfile = asyncHandler(async(req,res) => {
    const {username} = req.params;

    if(!username?.trim()) throw new ApiError(400,"Username is missing");

    const channel = await User.aggregate([
        {
            $match:{
                username:username?.toLowerCase()
            }
        },
        {
            $lookup:{
                from:"Subscription",
                localField:"_id",
                foreignField:"channel",
                as:"subscribers"
            }
        },
        {
            $lookup:{
                from:"Subscription",
                localField:"_id",
                foreignField:"subscriber",
                as:"subscribedTo"
            }
        },
        {
            $addFields:{
                subscribersCount:{
                    $size:"$subscribers"
                },
                channelsSubscribedToCount:{
                    $size:"$subscribedTo"
                },
                isSubscribed:{
                    $condition:{
                        if:{$in:[req.user?._id,"$subscribers.subscriber"]},
                        then:true,
                        else:false
                    }
                }
            }
        },
        {
            $project:{
                fullname:1,
                username:1,
                subscribersCount:1,
                channelsSubscribedToCount:1,
                isSubscribed:1,
                avatar:1,
                coverImage:1
            }
        }
    ]);

    if(!channel?.length) throw new ApiError(404,"Channel does not exist!");

    return res.status(200)
    .json(new ApiResponse(200,channel[0],"User channel fetched successfully!"));
})

const getWatchHistory = asyncHandler(async(req,res) => {
    const user = await User.aggregate([
       { 
        $match:{
            _id:new mongoose.Types.ObjectId(req.user._id)
        }
    },
    {
        $lookup:{
            from:"Videos",
            localField:"watchHistory",
            foreignField:"_id",
            as:"watchHistory",
            pipeline:[
                {
                    $lookup:{
                        from:"users",
                        localField:"owner",
                        foreignField:"_id",
                        as:"owner",
                        pipeline:[
                            {
                                $project:{
                                    fullname:1,
                                    username:1,
                                    avatar:1
                                }
                            }
                        ]
                    }
                },
                {
                    $addFields:{
                        owner:{
                            $first:"$owner"
                        }
                    }
                }
            ]
        }
    }
    ])

    return res.status(200)
    .json(new ApiResponse(200,user[0].watchHistory,"Wacth history fetched!"));
})

export {
    registerUser,
    loginUser,
    logOutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCover,
    getUserChannelProfile
};