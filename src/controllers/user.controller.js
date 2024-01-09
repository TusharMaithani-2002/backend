import {asyncHandler} from "../utils/async-Handler.js";
import {ApiError} from "../utils/ApiError.js";
import {User} from "../models/users.model.js";
import {uploadOnCloudinary} from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";


const registerUser = asyncHandler(async (req,res) => {
    
    const {fullname,username,password,email} = req.body
    
    if(
        [fullname,email,username,password].some((field) => field?.trim() === "")
    ) {
        throw new ApiError(400,"All fields are requierd!");
    }

    const existingUser = User.findOne({
        $or: [{username},{email}]
    });

    if(existingUser) throw new ApiError(409,"User already exists");


    const localPath = req.files?.avatar[0]?.path;
    const coverImageLocalPath = req.files?.coverImage[0]?.path;

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
})

export {registerUser};