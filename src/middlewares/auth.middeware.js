import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/users.model.js";

export const verifyJWT = async (req,res,next) => {

    // using cookieParser() middleware we added cookies in res and req
    try {
        const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ","");
        console.log(req)
    
        if(!token) throw new ApiError(401,"Unathourized request");
    
        const decodedToken = jwt.verify(token,process.env.ACCESS_TOKEN_SECRET);
    
        const user = await User.findById(decodedToken?._id).select("-password -refreshToken")
        if(!user) throw new ApiError(401,"Invalid Access Token");
    
        req.user = user;
        next();
    } catch (error) {
        throw new ApiError(401,error?.message || "Invalid access token");
    }
} 