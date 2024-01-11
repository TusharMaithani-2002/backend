import {asyncHandler} from "../utils/async-Handler.js";
import {ApiError} from "../utils/ApiError.js";
import { User } from "../models/users.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";


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
})

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
})

export {registerUser,loginUser,logOutUser};